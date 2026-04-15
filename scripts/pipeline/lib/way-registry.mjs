/**
 * Central registry tracking OSM way ID -> entry ownership.
 *
 * Every way discovered by the pipeline is registered here. The registry
 * is the single source of truth for "which entries have claimed which ways"
 * and enables structural dedup (way overlap) instead of name matching.
 *
 * Provenance: way IDs originate from Overpass responses (relation members
 * or named-way queries). They flow through the pipeline and are persisted
 * as `osm_way_ids` in bikepaths.yml.
 *
 * There is deliberately no `ownerOf(wayId)` method. Ways can legitimately
 * be claimed by more than one entry (a relation and a parallel-lane
 * discovery, a named way and an overlapping cycling route) and picking
 * "the first claimer" quietly is how order-dependent dedup bugs get in.
 * Callers must use `claimersOf(wayId)` and decide what they want.
 */
export class WayRegistry {
  constructor() {
    /** @type {Map<object, Set<number>>} entry -> Set<wayId> */
    this._entryToWays = new Map();
    /** @type {Map<number, Set<object>>} wayId -> Set<entry> (every claimer) */
    this._wayToClaimers = new Map();
  }

  /**
   * Claim way IDs for an entry. Records this entry as a claimer of every
   * way in the list; multiple entries can claim the same way legitimately
   * and all of them are remembered.
   */
  claim(entry, wayIds) {
    if (!this._entryToWays.has(entry)) this._entryToWays.set(entry, new Set());
    const entryWays = this._entryToWays.get(entry);
    for (const id of wayIds) {
      entryWays.add(id);
      let claimers = this._wayToClaimers.get(id);
      if (!claimers) {
        claimers = new Set();
        this._wayToClaimers.set(id, claimers);
      }
      claimers.add(entry);
    }
  }

  /**
   * Every entry that has claimed this way. Order is insertion order of
   * the underlying Set (first claimer first). Returns an empty array for
   * unclaimed ways.
   */
  claimersOf(wayId) {
    const claimers = this._wayToClaimers.get(wayId);
    return claimers ? [...claimers] : [];
  }

  /** All way IDs claimed by an entry. */
  wayIdsFor(entry) {
    return this._entryToWays.get(entry) || new Set();
  }

  /** Is this way ID claimed by any entry? */
  isClaimed(wayId) {
    return this._wayToClaimers.has(wayId);
  }

  /**
   * Find entries that share ways with a set of candidate way IDs.
   * Returns Map<entry, Set<overlapping wayIds>>.
   * Every claimer of each way is included, not just the first.
   */
  overlapWith(wayIds) {
    const result = new Map();
    for (const id of wayIds) {
      const claimers = this._wayToClaimers.get(id);
      if (!claimers) continue;
      for (const entry of claimers) {
        if (!result.has(entry)) result.set(entry, new Set());
        result.get(entry).add(id);
      }
    }
    return result;
  }

  /**
   * Transfer specific way IDs from one entry to another. The `from` entry
   * stops being a claimer of those ways and `to` becomes one. Other entries
   * that were also claiming the way are untouched.
   */
  transfer(from, to, wayIds) {
    if (!this._entryToWays.has(to)) this._entryToWays.set(to, new Set());
    const fromWays = this._entryToWays.get(from);
    const toWays = this._entryToWays.get(to);
    for (const id of wayIds) {
      if (fromWays) fromWays.delete(id);
      toWays.add(id);
      const claimers = this._wayToClaimers.get(id);
      if (claimers) {
        claimers.delete(from);
        claimers.add(to);
      } else {
        this._wayToClaimers.set(id, new Set([to]));
      }
    }
  }

  /** Remove an entry and drop all of its claims from the registry. */
  remove(entry) {
    const ways = this._entryToWays.get(entry);
    if (ways) {
      for (const id of ways) {
        const claimers = this._wayToClaimers.get(id);
        if (claimers) {
          claimers.delete(entry);
          if (claimers.size === 0) this._wayToClaimers.delete(id);
        }
      }
      this._entryToWays.delete(entry);
    }
  }

  /**
   * Find all way IDs claimed by more than one entry.
   * Returns array of { wayId, entries: [entry1, entry2, ...] }.
   */
  conflicts() {
    const result = [];
    for (const [wayId, claimers] of this._wayToClaimers) {
      if (claimers.size > 1) {
        result.push({ wayId, entries: [...claimers] });
      }
    }
    return result;
  }
}
