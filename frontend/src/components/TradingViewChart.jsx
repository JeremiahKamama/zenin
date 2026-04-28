import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
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

const normalizePriceLines = (priceLine, priceLines) => {
  const explicitLines = Array.isArray(priceLines) ? priceLines : [];
  const legacyLine = priceLine != null ? [{ price: priceLine }] : [];
  return [...legacyLine, ...explicitLines]
    .map((line, index) => {
      const price = Number(typeof line === 'object' ? line.price ?? line.value : line);
      if (!Number.isFinite(price)) return null;
      return {
        id: typeof line === 'object' && line.id ? String(line.id) : `line-${index}`,
        price,
        title: typeof line === 'object' ? line.title || '' : '',
        color: typeof line === 'object' ? line.color : undefined,
        lineStyle: typeof line === 'object' && line.lineStyle != null ? line.lineStyle : LineStyle.Dashed,
        lineWidth: typeof line === 'object' && line.lineWidth ? line.lineWidth : 1,
        axisLabelVisible: typeof line === 'object' && line.axisLabelVisible != null ? line.axisLabelVisible : true,
      };
    })
    .filter(Boolean);
};

const buildReadout = ({ mode, time, point, seriesEntry, valueFormatter, timeFormatter, readoutFormatter }) => {
  const value = resolvePointPrice(point);
  const baseReadout = {
    mode,
    time: timeFormatter(time, point),
    price: valueFormatter(value, point),
    detail: '',
  };
  if (typeof readoutFormatter !== 'function') return baseReadout;
  const custom = readoutFormatter({
    mode,
    time,
    point,
    series: seriesEntry,
    value,
    defaultReadout: baseReadout,
  });
  if (!custom) return baseReadout;
  if (typeof custom === 'string') return { ...baseReadout, price: custom };
  return { ...baseReadout, ...custom };
};

const getLatestReadout = (series, valueFormatter = formatReadoutPrice, timeFormatter = formatReadoutTime, readoutFormatter = null) => {
  const points = (Array.isArray(series) ? series : [])
    .filter((entry) => entry?.includeInReadout !== false)
    .flatMap((entry) => Array.isArray(entry?.data)
      ? entry.data.map((point) => ({ point, seriesEntry: entry }))
      : [])
    .map(({ point, seriesEntry }) => ({ ...point, seriesEntry, time: normalizeChartTime(point?.time) }))
    .filter((point) => point.time != null && resolvePointPrice(point) != null)
    .sort((a, b) => a.time - b.time);
  const latest = points[points.length - 1];
  if (!latest) return null;
  return buildReadout({
    mode: 'Latest',
    time: latest.time,
    point: latest,
    seriesEntry: latest.seriesEntry,
    valueFormatter,
    timeFormatter,
    readoutFormatter,
  });
};

export function TradingViewChart({
  series = [], // Array of { name, data, type: 'area' | 'line' | 'candlestick' | 'histogram', color, options }
  options = {},
  height = 400,
  width = '100%',
  priceLine = null, // Optional: value for a dashed horizontal price line
  priceLines = [],
  tradeMarkers = [],
  valueFormatter = formatReadoutPrice,
  timeFormatter = formatReadoutTime,
  readoutFormatter = null,
  crosshairEnabled = true,
  resetSignal = 0,
}) {
  const chartContainerRef = useRef();
  const chartRef = useRef(null);
  const seriesRef = useRef({});
  const markerRef = useRef(null);
  const [hoverReadout, setHoverReadout] = useState(null);
  const priceLineRefs = useRef({});
  const latestReadout = useMemo(
    () => getLatestReadout(series, valueFormatter, timeFormatter, readoutFormatter),
    [series, valueFormatter, timeFormatter, readoutFormatter]
  );

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
      mode: crosshairEnabled ? CrosshairMode.Normal : CrosshairMode.Hidden,
    },
    rightPriceScale: {
      borderVisible: false,
    },
    timeScale: {
      borderVisible: false,
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time) => {
        if (typeof options.tickMarkFormatter === 'function') {
          return options.tickMarkFormatter(time);
        }
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
  }), [options, crosshairEnabled]);

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

      const activeSeries = Object.values(seriesRef.current).find((entry) => entry?.api && entry?.includeInReadout !== false);
      const point = activeSeries?.api && param.seriesData?.get
        ? param.seriesData.get(activeSeries.api)
        : null;

      setHoverReadout(buildReadout({
        mode: 'Hovered',
        time: normalizeChartTime(param.time) ?? param.time,
        point,
        seriesEntry: activeSeries,
        valueFormatter,
        timeFormatter,
        readoutFormatter,
      }));
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
      priceLineRefs.current = {};
      seriesRef.current = {};
      chart.remove();
    };
  }, [defaultChartOptions, height, valueFormatter, timeFormatter, readoutFormatter]);

  useEffect(() => {
    if (!chartRef.current?.timeScale) return;
    try {
      chartRef.current.timeScale().fitContent();
    } catch (e) {}
  }, [resetSignal]);

  useEffect(() => {
    if (!chartRef.current) return;
    const primarySeriesName = series[0]?.name;
    const normalizedPriceLines = normalizePriceLines(priceLine, priceLines);
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
        delete priceLineRefs.current[name];
        delete seriesRef.current[name];
      }
    });

    // Add or update series
    series.forEach(({ name, data, type = 'area', color = '#38bdf8', options: seriesSpecificOptions = {} }) => {
      let activeSeries = seriesRef.current[name]?.api;
      const chart = chartRef.current;
      if (!chart) return;

      const addSeries = () => {
        if (type === 'area') {
          const seriesOptions = {
            lineColor: color,
            topColor: `${color}88`,
            bottomColor: `${color}00`,
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            ...seriesSpecificOptions,
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
            lastValueVisible: false,
            priceLineVisible: false,
            ...seriesSpecificOptions,
          };
          return typeof chart.addSeries === 'function'
            ? chart.addSeries(CandlestickSeries, seriesOptions)
            : chart.addCandlestickSeries?.(seriesOptions);
        }

        if (type === 'histogram') {
          const seriesOptions = {
            color,
            priceFormat: { type: 'volume' },
            priceScaleId: '',
            lastValueVisible: false,
            priceLineVisible: false,
            ...seriesSpecificOptions,
          };
          return typeof chart.addSeries === 'function'
            ? chart.addSeries(HistogramSeries, seriesOptions)
            : chart.addHistogramSeries?.(seriesOptions);
        }

        const seriesOptions = {
          color: color,
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          ...seriesSpecificOptions,
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
        delete priceLineRefs.current[name];
        delete seriesRef.current[name];
      }

      if (!activeSeries) {
        activeSeries = addSeries();
        if (!activeSeries) return;
        seriesRef.current[name] = { api: activeSeries, type, name, includeInReadout: series.find((item) => item.name === name)?.includeInReadout };
        if (seriesSpecificOptions.priceScaleOptions && chart.priceScale) {
          try {
            chart.priceScale(seriesSpecificOptions.priceScaleId ?? '').applyOptions(seriesSpecificOptions.priceScaleOptions);
          } catch (e) {}
        }
      } else if (seriesRef.current[name]) {
        seriesRef.current[name].includeInReadout = series.find((item) => item.name === name)?.includeInReadout;
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

        if (name === primarySeriesName && activeSeries.createPriceLine) {
          const refsForSeries = priceLineRefs.current[name] || {};
          Object.values(refsForSeries).forEach((lineRef) => {
            try {
              activeSeries.removePriceLine(lineRef);
            } catch (e) {}
          });
          priceLineRefs.current[name] = {};
          normalizedPriceLines.forEach((line) => {
            priceLineRefs.current[name][line.id] = activeSeries.createPriceLine({
              price: line.price,
              color: line.color || options.textColor || '#94a3b8',
              lineWidth: line.lineWidth,
              lineStyle: line.lineStyle,
              axisLabelVisible: line.axisLabelVisible,
              title: line.title,
            });
          });
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
  }, [series, priceLine, priceLines, tradeMarkers, options.textColor]);

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
          {(hoverReadout || latestReadout).detail ? (
            <small>{(hoverReadout || latestReadout).detail}</small>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
