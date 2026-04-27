import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  LineSeries,
  LineStyle,
} from 'lightweight-charts';

const normalizeChartTime = (time) => {
  if (time == null) return null;
  if (typeof time === 'object') {
    const year = Number(time.year);
    const month = Number(time.month);
    const day = Number(time.day);
    if ([year, month, day].every(Number.isFinite)) {
      return Math.floor(new Date(year, month - 1, day).getTime() / 1000);
    }
    return null;
  }
  if (typeof time === 'string') {
    const parsed = new Date(time).getTime();
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  const numeric = Number(time);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 10000000000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
};

const formatReadoutTime = (time) => {
  const normalized = normalizeChartTime(time);
  if (!normalized) return 'Date unavailable';
  const date = new Date(normalized * 1000);
  
  // Yahoo style: Apr 27, 2:36 PM
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

const resolvePointPrice = (point) => {
  if (!point) return null;
  const value = Number(point.value ?? point.close ?? point.price);
  return Number.isFinite(value) ? value : null;
};

const formatReadoutPrice = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Price unavailable';
  return `$${numeric.toLocaleString(undefined, {
    minimumFractionDigits: numeric >= 1000 ? 2 : 4,
    maximumFractionDigits: numeric >= 1000 ? 2 : 4,
  })}`;
};

const getLatestReadout = (series) => {
  const points = (Array.isArray(series) ? series : [])
    .flatMap((entry) => Array.isArray(entry?.data) ? entry.data : [])
    .map((point) => ({ ...point, time: normalizeChartTime(point?.time) }))
    .filter((point) => point.time != null && resolvePointPrice(point) != null)
    .sort((a, b) => a.time - b.time);
  const latest = points[points.length - 1];
  if (!latest) return null;
  return {
    mode: 'Latest',
    time: formatReadoutTime(latest.time),
    price: formatReadoutPrice(resolvePointPrice(latest)),
  };
};

export function TradingViewChart({
  series = [], // Array of { name, data: [{time, value}], type: 'area' | 'line' | 'candlestick', color }
  options = {},
  height = 400,
  width = '100%',
  priceLine = null, // Optional: value for a dashed horizontal price line
  tradeMarkers = []
}) {
  const chartContainerRef = useRef();
  const chartRef = useRef(null);
  const seriesRef = useRef({});
  const markerRef = useRef(null);
  const [hoverReadout, setHoverReadout] = useState(null);
  const priceLineRef = useRef(null);
  const latestReadout = useMemo(() => getLatestReadout(series), [series]);

  const defaultChartOptions = useMemo(() => ({
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#94a3b8',
      fontFamily: 'Inter, system-ui, sans-serif',
    },
    grid: {
      vertLines: { color: 'rgba(148, 163, 184, 0.08)' },
      horzLines: { color: 'rgba(148, 163, 184, 0.08)' },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderVisible: false,
    },
    timeScale: {
      borderVisible: false,
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time) => {
        const date = new Date(time * 1000 || time);
        const hours = date.getHours();
        const minutes = date.getMinutes();
        if (hours === 0 && minutes === 0) {
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        return date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
      }
    },
    ...options
  }), [options]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth || 300,
      height: typeof height === 'number' ? height : 400,
      ...defaultChartOptions,
    });
    chartRef.current = chart;

    // Use ResizeObserver for more reliable resizing (e.g. when parent becomes visible)
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries[0].contentRect.width > 0 && chartRef.current) {
        chartRef.current.applyOptions({ width: entries[0].contentRect.width });
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    const handleCrosshairMove = (param) => {
      if (!param?.time) {
        setHoverReadout(null);
        return;
      }

      const activeSeries = Object.values(seriesRef.current).find((entry) => entry?.api);
      const point = activeSeries?.api && param.seriesData?.get
        ? param.seriesData.get(activeSeries.api)
        : null;
      const price = resolvePointPrice(point);

      setHoverReadout({
        mode: 'Hovered',
        time: formatReadoutTime(param.time),
        price: formatReadoutPrice(price),
      });
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    return () => {
      resizeObserver.disconnect();
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      // Clear stale series refs before destroying the chart so the
      // data-setting effect doesn't attempt to call setData on dead instances.
      if (markerRef.current?.setMarkers) {
        markerRef.current.setMarkers([]);
      }
      markerRef.current = null;
      seriesRef.current = {};
      chart.remove();
    };
  }, [defaultChartOptions, height]);

  useEffect(() => {
    if (!chartRef.current) return;
    const primarySeriesName = series[0]?.name;
    const normalizedTradeMarkers = (Array.isArray(tradeMarkers) ? tradeMarkers : [])
      .map((marker) => {
        const time = normalizeChartTime(marker?.time);
        if (time == null) return null;
        return {
          ...marker,
          time,
        };
      })
      .filter(Boolean)
      .sort((a, b) => Number(a.time || 0) - Number(b.time || 0));

    // Clean up existing series map if replacing all data
    const currentSeriesNames = series.map(s => s.name);
    Object.keys(seriesRef.current).forEach(name => {
      if (!currentSeriesNames.includes(name) && chartRef.current?.removeSeries) {
        try {
          chartRef.current.removeSeries(seriesRef.current[name].api);
        } catch (e) {
          console.warn("TradingViewChart: Error removing series", e);
        }
        delete seriesRef.current[name];
      }
    });

    // Add or update series
    series.forEach(({ name, data, type = 'area', color = '#38bdf8' }) => {
      let activeSeries = seriesRef.current[name]?.api;
      const chart = chartRef.current;
      if (!chart) return;

      const addSeries = () => {
        if (type === 'area') {
          const seriesOptions = {
            lineColor: options.textColor || '#38bdf8',
            topColor: `${color}88`,
            bottomColor: `${color}00`,
            lineWidth: 2,
          };
          return typeof chart.addSeries === 'function'
            ? chart.addSeries(AreaSeries, seriesOptions)
            : chart.addAreaSeries?.(seriesOptions);
        }

        if (type === 'candlestick') {
          const seriesOptions = {
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderVisible: false,
            wickVisible: true,
          };
          return typeof chart.addSeries === 'function'
            ? chart.addSeries(CandlestickSeries, seriesOptions)
            : chart.addCandlestickSeries?.(seriesOptions);
        }

        const seriesOptions = {
          color: color,
          lineWidth: 2,
        };
        return typeof chart.addSeries === 'function'
          ? chart.addSeries(LineSeries, seriesOptions)
          : chart.addLineSeries?.(seriesOptions);
      };

      if (activeSeries && seriesRef.current[name]?.type !== type && chart.removeSeries) {
        try {
          if (name === primarySeriesName && markerRef.current?.setMarkers) {
            markerRef.current.setMarkers([]);
            markerRef.current = null;
          }
          chart.removeSeries(activeSeries);
        } catch (e) {
          console.warn("TradingViewChart: Error replacing series", e);
        }
        activeSeries = null;
        delete seriesRef.current[name];
      }

      if (!activeSeries) {
        activeSeries = addSeries();
        if (!activeSeries) return;
        seriesRef.current[name] = { api: activeSeries, type };
      }

      // Ensure data is sorted by time and time is standard unix timestamp
      const sortedData = [...(data || [])].sort((a, b) => {
        const timeA = typeof a.time === 'string' ? new Date(a.time).getTime() / 1000 : a.time;
        const timeB = typeof b.time === 'string' ? new Date(b.time).getTime() / 1000 : b.time;
        return timeA - timeB;
      }).map(item => ({
        ...item,
        time: typeof item.time === 'string' ? new Date(item.time).getTime() / 1000 : (item.time > 10000000000 ? Math.floor(item.time / 1000) : item.time)
      }));

      // Filter out duplicate times
      const uniqueData = [];
      let lastTime = 0;
      for (const item of sortedData) {
        if (item.time !== lastTime) {
          uniqueData.push(item);
          lastTime = item.time;
        }
      }

      try {
        activeSeries.setData(uniqueData);

        if (name === primarySeriesName) {
          try {
            if (!markerRef.current && typeof createSeriesMarkers === 'function') {
              markerRef.current = createSeriesMarkers(activeSeries, normalizedTradeMarkers);
            } else if (markerRef.current?.setMarkers) {
              markerRef.current.setMarkers(normalizedTradeMarkers);
            }
          } catch (markerError) {
            console.warn("TradingViewChart: Error setting trade markers", markerError);
          }
        }

        // Manage Price Line
        if (priceLine != null && Number.isFinite(Number(priceLine)) && activeSeries.createPriceLine) {
          if (priceLineRef.current) {
            try {
              activeSeries.removePriceLine(priceLineRef.current);
            } catch (e) {}
          }
          priceLineRef.current = activeSeries.createPriceLine({
            price: Number(priceLine),
            color: options.textColor || '#94a3b8',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: '',
          });
        } else if (priceLineRef.current) {
          try {
            activeSeries.removePriceLine(priceLineRef.current);
          } catch (e) {}
          priceLineRef.current = null;
        }
      } catch (err) {
        console.warn(`TradingViewChart: Error setting data for series ${name}`, err);
      }
    });

    if (!series.length && markerRef.current?.setMarkers) {
      markerRef.current.setMarkers([]);
    }
    
    if (chartRef.current?.timeScale) {
      try {
        chartRef.current.timeScale().fitContent();
      } catch (e) {}
    }
  }, [series, priceLine, tradeMarkers]);

  return (
    <div
      className="tradingview-chart-shell"
      style={{ width, height: typeof height === 'number' ? `${height}px` : height, position: 'relative' }}
    >
      <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
      {(hoverReadout || latestReadout) ? (
        <div className="tradingview-chart-readout" aria-live="polite">
          <span>{(hoverReadout || latestReadout).mode}</span>
          <strong>{(hoverReadout || latestReadout).price}</strong>
          <em>{(hoverReadout || latestReadout).time}</em>
        </div>
      ) : null}
    </div>
  );
}
