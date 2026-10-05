import { describe, it, expect } from "vitest";
import { LRUCache } from "../DataStructures/LRUCache.js";

describe("LRUCache", () => {
	it("should store and retrieve values", () => {
		const cache = new LRUCache<string, number>(2);
		cache.set("a", 1);
		cache.set("b", 2);

		expect(cache.get("a")).toBe(1);
		expect(cache.get("b")).toBe(2);
	});

	it("should evict LRU item when capacity is exceeded", () => {
		const cache = new LRUCache<string, number>(2);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3);

		expect(cache.has("a")).toBe(false);
		expect(cache.has("b")).toBe(true);
		expect(cache.has("c")).toBe(true);
	});

	it("should mark item as recently used on get", () => {
		const cache = new LRUCache<string, number>(2);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.get("a");
		cache.set("c", 3);

		expect(cache.has("a")).toBe(true);
		expect(cache.has("b")).toBe(false);
		expect(cache.has("c")).toBe(true);
	});

	it("should mark item as recently used on update", () => {
		const cache = new LRUCache<string, number>(2);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("a", 10);
		cache.set("c", 3);

		expect(cache.has("a")).toBe(true);
		expect(cache.get("a")).toBe(10);
		expect(cache.has("b")).toBe(false);
		expect(cache.has("c")).toBe(true);
	});

	it("should return undefined for non-existent keys", () => {
		const cache = new LRUCache<string, number>(2);
		expect(cache.get("nonexistent")).toBeUndefined();
	});

	it("should implement has correctly", () => {
		const cache = new LRUCache<string, number>(2);
		cache.set("a", 1);

		expect(cache.has("a")).toBe(true);
		expect(cache.has("b")).toBe(false);
	});

	it("should implement delete correctly", () => {
		const cache = new LRUCache<string, number>(2);
		cache.set("a", 1);
		cache.set("b", 2);

		expect(cache.delete("a")).toBe(true);
		expect(cache.delete("nonexistent")).toBe(false);
		expect(cache.has("a")).toBe(false);
		expect(cache.size).toBe(1);
	});

	it("should implement clear correctly", () => {
		const cache = new LRUCache<string, number>(2);
		cache.set("a", 1);
		cache.set("b", 2);

		cache.clear();
		expect(cache.size).toBe(0);
		expect(cache.has("a")).toBe(false);
		expect(cache.has("b")).toBe(false);
	});

	it("should track size correctly", () => {
		const cache = new LRUCache<string, number>(3);
		expect(cache.size).toBe(0);

		cache.set("a", 1);
		expect(cache.size).toBe(1);

		cache.set("b", 2);
		expect(cache.size).toBe(2);

		cache.set("c", 3);
		expect(cache.size).toBe(3);

		cache.set("d", 4);
		expect(cache.size).toBe(3);
	});

	it("should work with various types", () => {
		const cache = new LRUCache<number, { data: string }>(2);
		cache.set(1, { data: "hello" });
		cache.set(2, { data: "world" });

		const val = cache.get(1);
		expect(val).toEqual({ data: "hello" });
	});

	it("should throw on invalid capacity", () => {
		expect(() => new LRUCache<string, number>(0)).toThrow("Capacity must be greater than 0");
		expect(() => new LRUCache<string, number>(-5)).toThrow("Capacity must be greater than 0");
	});

	it("should handle capacity of 1", () => {
		const cache = new LRUCache<string, number>(1);
		cache.set("a", 1);
		expect(cache.get("a")).toBe(1);

		cache.set("b", 2);
		expect(cache.has("a")).toBe(false);
		expect(cache.get("b")).toBe(2);
	});
});