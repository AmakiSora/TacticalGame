// public/map-labels.js
// 地图显示名：统一取自 GET /api/maps（来源是 maps/*.json 的 name 字段）。
// 早期各页面各有一份手写 id→中文名表，新增地图忘了加就会露出英文 mapId
// （歼灭图 trench-run 曾因此在竞技场显示为「trench-run」），故改为运行时按权威清单加载。
let labels = new Map();
let pending = null;

/** 地图 id → 中文名；清单未加载或地图不在清单里时原样返回 id。 */
export function mapLabel(id) {
  return labels.get(id) || id;
}

/** 加载地图名清单（并发调用共用同一个请求）；失败时保留 id 回退，不影响页面其余部分。 */
export function loadMapLabels() {
  if (!pending) {
    pending = fetch('/api/maps', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        const list = Array.isArray(data) ? data : (Array.isArray(data?.maps) ? data.maps : []);
        labels = new Map(list
          .filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && item.name)
          .map(item => [item.id, item.name]));
      })
      .catch(() => { /* 拉不到就显示 id，页面其余功能照常 */ });
  }
  return pending;
}
