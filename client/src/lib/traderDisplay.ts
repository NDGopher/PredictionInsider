/** English desk labels. Wallet hex is not a product name. */

const KNOWN: Record<string, string> = {
  "0xec981ed70ae69c5cbcac08c1ba063e734f6bafcd": "Heavy888",
  "0xheavy888": "Heavy888",
  "0x8a3ab8120807bd64a3de48695110e390fa2ceb9a": "8a3a",
  "0x5966db1fe50763c9e3c014d756369bad07e1f804": "5966",
  "0x20d6436849f930584892730c7f96ebb2ac763856": "20D6",
  "0xe30e74595517de48f1fb19f4553dd3d9f1e96b87": "E30E",
  "0xcb6ed9332a8fd1b930893c705dd234f37aa248e6": "Cb6E",
  "0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8": "HVAB",
};

const WALLET_RE = /^0x[a-fA-F0-9]{8,}$/;
const HEX_TS_RE = /^0x[a-fA-F0-9]{10,}-\d{9,}$/;
const AUTO_PSEUDO_RE = /^[A-Z][a-z]+-[A-Z][a-z]+$/;

export function fixMojibake(text: string): string {
  let raw = (text || "").replace(/\uFFFD/g, "").replace(/�/g, "");
  if (/Ã|Â|â€/.test(raw)) {
    try {
      const bytes = Uint8Array.from(Array.from(raw, (ch) => ch.charCodeAt(0) & 0xff));
      raw = new TextDecoder("utf-8").decode(bytes);
    } catch {
      /* keep stripped text */
    }
  }
  return raw.trim();
}

export function englishName(username?: string | null, wallet?: string | null): string {
  const user = fixMojibake(username || "");
  const w = (wallet || "").trim().toLowerCase();
  if (w && KNOWN[w]) return KNOWN[w];
  if (user && KNOWN[user.toLowerCase()]) return KNOWN[user.toLowerCase()];
  const looksWallet = WALLET_RE.test(user) || HEX_TS_RE.test(user) || AUTO_PSEUDO_RE.test(user) || !user;
  if (!looksWallet) return user;
  const hex = (w || user).replace(/^0x/i, "");
  return hex ? `Book ${hex.slice(0, 4)}` : "Book";
}

export function shortWallet(wallet?: string | null): string {
  const w = wallet || "";
  if (w.length > 12) return `${w.slice(0, 8)}…${w.slice(-4)}`;
  return w;
}
