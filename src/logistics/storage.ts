// 本地存储层：仅负责读写与序列化，刷新后数据一致
import { DEFAULT_ROUTE_RULES } from "./rules";
import type { Consignment, QuoteRecord, RouteRule } from "./types";

const KEY_PREFIX = "hxwlfront-13";
export const STORAGE_KEYS = {
  quotes: `${KEY_PREFIX}-freight`,
  consignments: `${KEY_PREFIX}-consignments`,
  routeRules: `${KEY_PREFIX}-route-rules`,
} as const;

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

/** 读取报价列表；无任何数据时返回 null，由上层播入种子数据（兼容旧版存储结构） */
export function loadQuotes(): QuoteRecord[] | null {
  return readJSON<QuoteRecord[]>(STORAGE_KEYS.quotes);
}

export function saveQuotes(quotes: QuoteRecord[]): void {
  writeJSON(STORAGE_KEYS.quotes, quotes);
}

export function loadConsignments(): Consignment[] {
  return readJSON<Consignment[]>(STORAGE_KEYS.consignments) ?? [];
}

export function saveConsignments(consignments: Consignment[]): void {
  writeJSON(STORAGE_KEYS.consignments, consignments);
}

export function loadRouteRules(): RouteRule[] {
  const saved = readJSON<RouteRule[]>(STORAGE_KEYS.routeRules);
  if (saved && saved.length > 0) return saved;
  return DEFAULT_ROUTE_RULES.map((rule) => ({ ...rule }));
}

export function saveRouteRules(rules: RouteRule[]): void {
  writeJSON(STORAGE_KEYS.routeRules, rules);
}
