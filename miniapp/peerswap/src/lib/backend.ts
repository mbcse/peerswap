export const BACKEND_URL: string =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8787";

export const backend = {
  listSwaps: async (status?: string) => {
    const url = status ? `${BACKEND_URL}/swaps?status=${status}` : `${BACKEND_URL}/swaps`;
    const r = await fetch(url, { cache: "no-store" });
    return r.json();
  },
  createSwap: async (body: unknown) => {
    const r = await fetch(`${BACKEND_URL}/swaps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json();
  },
  claimSwap: async (secret: string, hashlock: string, userAddress: string) => {
    const r = await fetch(`${BACKEND_URL}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, hashlock, userAddress }),
    });
    return r.json();
  },
};


