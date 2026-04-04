# Beatclick

Browser drum-grid sequencer with audio-file chopping into four random one-beat slices.

## Run

1. Install dependencies:

```bash
npm install
```

2. Start dev server:

```bash
npm run dev
```

## Controls

- Space: play/stop
- 1, 2, 3, 4: preview the four loaded sample slots

## Import Workflow

- Use the Audio file control in the app.
- The app slices the file into four random one-beat samples at current BPM.
- Samples map to rows and can be previewed with keys 1 to 4.
