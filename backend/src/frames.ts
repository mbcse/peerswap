import { Request, Response, Router } from "express";
import { listSwaps } from "./store";

export const frames = Router();

function frameHtml({ title, imageUrl, buttons }: { title: string; imageUrl: string; buttons: { label: string; action: string }[] }) {
  return `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="${title}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta name="fc:frame" content="vNext" />
    ${buttons
      .map((b, i) => `<meta name="fc:frame:button:${i + 1}" content="${b.label}" /><meta name="fc:frame:button:${i + 1}:action" content="post" /><meta name="fc:frame:post_url" content="${b.action}" />`)
      .join("\n    ")}
  </head>
  <body></body>
 </html>`;
}

frames.get("/create", (_req: Request, res: Response) => {
  const html = frameHtml({
    title: "PeerSwap: Create Swap",
    imageUrl: "https://dummyimage.com/1200x630/111/fff&text=PeerSwap+Create",
    buttons: [
      { label: "Use Sepolia", action: "https://your-backend/frames/create/chain?c=sepolia" },
      { label: "Use Base Sepolia", action: "https://your-backend/frames/create/chain?c=baseSepolia" },
    ],
  });
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

frames.get("/fulfill", (_req: Request, res: Response) => {
  const swaps = listSwaps();
  const latest = swaps[swaps.length - 1];
  const title = latest ? `Fulfill swap: ${latest.executionData.hashlock}` : "No swaps yet";
  const html = frameHtml({
    title,
    imageUrl: "https://dummyimage.com/1200x630/111/fff&text=PeerSwap+Fulfill",
    buttons: latest
      ? [{ label: "Details", action: `https://your-backend/frames/fulfill/details?h=${latest.executionData.hashlock}` }]
      : [],
  });
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

frames.post("/fulfill/details", (req: Request, res: Response) => {
  const h = (req.query.h as string) || "";
  const swaps = listSwaps();
  const rec = swaps.find((s) => s.executionData.hashlock.toLowerCase() === h.toLowerCase());
  const info = rec
    ? `dstEscrow: ${rec.dstEscrow}\nsrcEscrow: ${rec.srcEscrow}\naskerAmount: ${rec.executionData.askerAmount.toString()}\nfullfillerAmount: ${rec.executionData.fullfillerAmount.toString()}`
    : "Not found";
  const html = frameHtml({
    title: "PeerSwap: Swap Details",
    imageUrl: `https://dummyimage.com/1200x630/222/fff&text=${encodeURIComponent(info)}`,
    buttons: [],
  });
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});


