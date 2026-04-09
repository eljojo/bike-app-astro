/**
 * Central registry tracking OSM way ID -> entry ownership.
 *
 * Every way discovered by the pipeline is registered here. The registry
 * is the single source of truth for "which entry owns which ways" and
 * enables structural dedup (way overlap) instead of name matching.
 *
 * Provenance: way IDs originate from Overpass responses (relation members
 * or named-way queries). They flow through the pipeline and are persisted
 * as `osm_way_ids` in bikepaths.yml.
 */
export class WayRegistry {
  constructor() {
    /** @type {Map<number, object>} wayId -> entry */
    this._wayToEntry = new Map();
    /** @type {Map<object, Set<number>>} entry -> Set<wayId> */
    this._entryToWays = new Map();
  }

  /**
   * Claim way IDs for an entry. If a way is already claimed by the same
   * entry, this is a no-op for that way. If claimed by a different entry,
   * both claims are recorded (detected by conflicts()).
   */
  claim(entry, wayIds) {
    if (!this._entryToWays.has(entry)) this._entryToWays.set(entry, new Set());
    const entryWays = this._entryToWays.get(entry);
    for (const id of wayIds) {
      if (!this._wayToEntry.has(id)) {
        this._wayToEntry.set(id, entry);
      }
      entryWays.add(id);
    }
  }

  /** Which entry owns this way? Returns undefined if unclaimed. */
  ownerOf(wayId) {
    return this._wayToEntry.get(wayId);
  }

  /** All way IDs claimed by an entry. */
  wayIdsFor(entry) {
    return this._entryToWays.get(entry) || new Set();
  }

  /** Is this way ID claimed by any entry? */
  isClaimed(wayId) {
    return this._wayToEntry.has(wayId);
  }

  /**
   * Find entries that share ways with a set of candidate way IDs.
   * Returns Map<entry, Set<overlapping wayIds>>.
   */
  overlapWith(wayIds) {
    const result = new Map();
    for (const id of wayIds) {
      const owner = this._wayToEntry.get(id);
      if (!owner) continue;
      if (!result.has(owner)) result.set(owner, new Set());
      result.get(owner).add(id);
    }
    return result;
  }

  /**
   * Transfer specific way IDs from one entry to another.
   */
  transfer(from, to, wayIds) {
    if (!this._entryToWays.has(to)) this._entryToWays.set(to, new Set());
    const fromWays = this._entryToWays.get(from);
    const toWays = this._entryToWays.get(to);
    for (const id of wayIds) {
      if (fromWays) fromWays.delete(id);
      toWays.add(id);
      this._wayToEntry.set(id, to);
    }
  }

  /** Remove an entry and release all its claimed ways. */
  remove(entry) {
    const ways = this._entryToWays.get(entry);
    if (ways) {
      for (const id of ways) {
        if (this._wayToEntry.get(id) === entry) {
          this._wayToEntry.delete(id);
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
    const wayToAll = new Map();
    for (const [entry, ways] of this._entryToWays) {
      for (const id of ways) {
        if (!wayToAll.has(id)) wayToAll.set(id, []);
        wayToAll.get(id).push(entry);
      }
    }
    const result = [];
    for (const [wayId, entries] of wayToAll) {
      if (entries.length > 1) {
        result.push({ wayId, entries });
      }
    }
    return result;
  }
}
