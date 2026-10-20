// src/utils/metrics.ts
// 进程内轻量指标注册表：只支持 counter / gauge / histogram，输出 Prometheus 文本格式。
// 不引入 prom-client；标签必须低基数（禁止 gameId/playerId 等），避免指标本身成为内存泄漏。
type LabelValue = string | number | boolean;
type Labels = Record<string, LabelValue>;

interface MetricValue {
  labels: string;
  value: number;
}

interface Counter {
  help: string;
  values: Map<string, MetricValue>;
}

interface Gauge {
  help: string;
  values: Map<string, MetricValue>;
}

interface HistogramValue extends MetricValue {
  count: number;
  sum: number;
  buckets: number[];
}

interface Histogram {
  help: string;
  buckets: number[];
  values: Map<string, HistogramValue>;
}

const counters = new Map<string, Counter>();
const gauges = new Map<string, Gauge>();
const histograms = new Map<string, Histogram>();
const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function labelKey(labels: Labels = {}): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return keys.map(key => `${key}="${escapeLabel(String(labels[key]))}"`).join(',');
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function series(labels: string): string {
  return labels ? `{${labels}}` : '';
}

export function inc(name: string, labels: Labels = {}, amount = 1): void {
  let counter = counters.get(name);
  if (!counter) {
    counter = { help: name, values: new Map() };
    counters.set(name, counter);
  }
  const key = labelKey(labels);
  const entry = counter.values.get(key);
  if (entry) entry.value += amount;
  else counter.values.set(key, { labels: key, value: amount });
}

export function setGauge(name: string, value: number, labels: Labels = {}): void {
  let gauge = gauges.get(name);
  if (!gauge) {
    gauge = { help: name, values: new Map() };
    gauges.set(name, gauge);
  }
  const key = labelKey(labels);
  const entry = gauge.values.get(key);
  if (entry) entry.value = value;
  else gauge.values.set(key, { labels: key, value });
}

export function observe(name: string, value: number, labels: Labels = {}, buckets = DEFAULT_BUCKETS): void {
  let histogram = histograms.get(name);
  if (!histogram) {
    histogram = { help: name, buckets, values: new Map() };
    histograms.set(name, histogram);
  }
  const key = labelKey(labels);
  let entry = histogram.values.get(key);
  if (!entry) {
    entry = {
      labels: key,
      value: 0,
      count: 0,
      sum: 0,
      buckets: histogram.buckets.map(() => 0),
    };
    histogram.values.set(key, entry);
  }
  if (!Number.isFinite(value)) return;
  entry.value = value;
  entry.count += 1;
  entry.sum += value;
  for (let i = 0; i < histogram.buckets.length; i++) {
    if (value <= histogram.buckets[i]!) entry.buckets[i]! += 1;
  }
}

export function renderMetrics(): string {
  const lines: string[] = [];
  for (const [name, counter] of counters) {
    lines.push(`# HELP ${name} ${counter.help}`, `# TYPE ${name} counter`);
    for (const entry of counter.values.values()) {
      lines.push(`${name}${series(entry.labels)} ${entry.value}`);
    }
  }
  for (const [name, gauge] of gauges) {
    lines.push(`# HELP ${name} ${gauge.help}`, `# TYPE ${name} gauge`);
    for (const entry of gauge.values.values()) {
      lines.push(`${name}${series(entry.labels)} ${entry.value}`);
    }
  }
  for (const [name, histogram] of histograms) {
    lines.push(`# HELP ${name} ${histogram.help}`, `# TYPE ${name} histogram`);
    for (const entry of histogram.values.values()) {
      for (let i = 0; i < histogram.buckets.length; i++) {
        const bucketLabels = entry.labels
          ? `${entry.labels},le="${histogram.buckets[i]}"`
          : `le="${histogram.buckets[i]}"`;
        lines.push(`${name}_bucket{${bucketLabels}} ${entry.buckets[i]}`);
      }
      const infLabels = entry.labels ? `${entry.labels},le="+Inf"` : 'le="+Inf"';
      lines.push(`${name}_bucket{${infLabels}} ${entry.count}`);
      lines.push(`${name}_sum${series(entry.labels)} ${entry.sum}`);
      lines.push(`${name}_count${series(entry.labels)} ${entry.count}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** 测试用：清空所有指标。 */
export function resetMetrics(): void {
  counters.clear();
  gauges.clear();
  histograms.clear();
}
