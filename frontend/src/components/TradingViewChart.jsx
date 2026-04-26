import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  CrosshairMode,
  LineSeries,
} from 'lightweight-charts';

export function TradingViewChart({
  series = [], // Array of { name, data: [{time, value}], type: 'area' | 'line' | 'candlestick', color }
  options = {},
  height = 400,
  width = '100%'
}) {
  const chartContainerRef = useRef();
  const chartRef = useRef(null);
  const seriesRef = useRef({});

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
        return date.toLocaleDateString();
      }
    },
    ...options
  }), [options]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: typeof height === 'number' ? height : 400,
      ...defaultChartOptions,
    });
    chartRef.current = chart;

    // Window resize handler
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [defaultChartOptions, height]);

  useEffect(() => {
    if (!chartRef.current) return;

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
          const options = {
            lineColor: color,
            topColor: `${color}88`,
            bottomColor: `${color}00`,
            lineWidth: 2,
          };
          return typeof chart.addSeries === 'function'
            ? chart.addSeries(AreaSeries, options)
            : chart.addAreaSeries?.(options);
        }

        if (type === 'candlestick') {
          const options = {
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#22c55e',
            wickDownColor: '#ef4444',
          };
          return typeof chart.addSeries === 'function'
            ? chart.addSeries(CandlestickSeries, options)
            : chart.addCandlestickSeries?.(options);
        }

        const options = {
          color: color,
          lineWidth: 2,
        };
        return typeof chart.addSeries === 'function'
          ? chart.addSeries(LineSeries, options)
          : chart.addLineSeries?.(options);
      };

      if (activeSeries && seriesRef.current[name]?.type !== type && chart.removeSeries) {
        try {
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
      } catch (err) {
        console.warn(`TradingViewChart: Error setting data for series ${name}`, err);
      }
    });
    
    if (chartRef.current?.timeScale) {
      try {
        chartRef.current.timeScale().fitContent();
      } catch (e) {}
    }
  }, [series]);

  return (
    <div
      ref={chartContainerRef}
      style={{ width, height: typeof height === 'number' ? `${height}px` : height, position: 'relative' }}
    />
  );
}
