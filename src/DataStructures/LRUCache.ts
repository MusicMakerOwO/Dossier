interface Node<K, V> {
	key: K;
	value: V;
	prev: Node<K, V> | null;
	next: Node<K, V> | null;
}

/** A Map that evicts its least recently used entry at capacity. `get` and `set` count as a use; `has` does not. */
export class LRUCache<K, V> extends Map<K, V> {
	#capacity: number;
	#head: Node<K, V> | null = null;
	#tail: Node<K, V> | null = null;
	#nodeMap = new Map<K, Node<K, V>>();

	constructor(capacity: number) {
		super();
		if (capacity <= 0) throw new Error("Capacity must be greater than 0");
		this.#capacity = capacity;
	}

	override get(key: K): V | undefined {
		const node = this.#nodeMap.get(key);
		if (!node) return undefined;
		this.#moveToHead(node);
		return node.value;
	}

	override set(key: K, value: V): this {
		if (this.#nodeMap.has(key)) {
			const node = this.#nodeMap.get(key)!;
			node.value = value;
			this.#moveToHead(node);
		} else {
			if (this.#nodeMap.size >= this.#capacity) {
				this.#evictLRU();
			}
			const node: Node<K, V> = { key, value, prev: null, next: null };
			this.#nodeMap.set(key, node);
			this.#addToHead(node);
		}
		return this;
	}

	override has(key: K): boolean {
		return this.#nodeMap.has(key);
	}

	override delete(key: K): boolean {
		const node = this.#nodeMap.get(key);
		if (!node) return false;
		this.#removeNode(node);
		this.#nodeMap.delete(key);
		return true;
	}

	override clear(): void {
		this.#head = null;
		this.#tail = null;
		this.#nodeMap.clear();
	}

	override get size(): number {
		return this.#nodeMap.size;
	}

	#moveToHead(node: Node<K, V>): void {
		if (node === this.#head) return;
		this.#removeNode(node);
		this.#addToHead(node);
	}

	#addToHead(node: Node<K, V>): void {
		node.next = this.#head;
		node.prev = null;
		if (this.#head) {
			this.#head.prev = node;
		}
		this.#head = node;
		if (!this.#tail) {
			this.#tail = node;
		}
	}

	#removeNode(node: Node<K, V>): void {
		if (node.prev) {
			node.prev.next = node.next;
		} else {
			this.#head = node.next;
		}
		if (node.next) {
			node.next.prev = node.prev;
		} else {
			this.#tail = node.prev;
		}
	}

	#evictLRU(): void {
		if (!this.#tail) return;
		const key = this.#tail.key;
		this.delete(key);
	}
}