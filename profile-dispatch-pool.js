'use strict';
// Bound database pressure while isolating a slow/failed account from its peers.
async function dispatchProfiles(profiles, work, concurrency = 4) {
  let next = 0;
  const errors = [];
  async function worker() {
    while (next < profiles.length) {
      const profile = profiles[next++];
      try { await work(profile); } catch (error) { errors.push(error); }
    }
  }
  await Promise.all(Array.from({length: Math.min(concurrency, profiles.length)}, worker));
  return errors;
}
module.exports = {dispatchProfiles};
