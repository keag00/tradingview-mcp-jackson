# Claude brain

Saved references, ideas, and media the user wants Claude to remember across sessions. Newest entries first.

---

## 2026-07-20 — Opening Range Breakout strategy reel (@flexingjoetrades)

- **Source:** https://www.instagram.com/reel/Da_t7b0xvVU/
- **Video:** [`media/2026-07-20-flexingjoetrades-orb-reel.mp4`](media/2026-07-20-flexingjoetrades-orb-reel.mp4) (41s)
- **Caption:** "5 for 5 today! Comment CHECKLIST if you want to learn how I did it!" — overlay: "This simple strategy won all day!"

### Strategy (from the video)

An **Opening Range Breakout (ORB)** day-trading strategy, demonstrated on NASDAQ (NQ):

1. Mark the **opening range high and low** from the first bars of the session.
2. **Wait** — no trade while price is still inside the range.
3. Watch how price **interacts** with the range boundaries and an **EMA** overlaid on the chart (red line; declining EMA above price = short bias, rising EMA below = long bias).
4. Enter when price breaks and holds **outside** the range in the direction of the EMA trend — the video shows shorts triggered on breaks below the opening range low with the EMA sloping down overhead, including entries on a retest of the range low from below.
5. Stop goes on the other side of the breakout level; targets are multiple R. The five winners shown had risk/reward ratios of **2.19, 2.6, 2.8, 3.22, and 4.8**.

### Relevance to this repo

- Could be implemented as a Pine indicator/strategy (opening range lines + EMA filter + breakout signals) via the `pine-develop` workflow.
- The ORB-below-EMA confluence could be added to `rules.json` bias criteria or checked in `morning_brief` / `trade-alert` scans.
