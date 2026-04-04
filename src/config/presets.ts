export type TrackDef = {
  id: string
  label: string
  file: string
}

export const TRACKS: TrackDef[] = [
  { id: 'kick', label: 'Kick', file: 'kick.wav' },
  { id: 'snare', label: 'Snare', file: 'snare.wav' },
  { id: 'hihat', label: 'Hi-hat', file: 'hihat.wav' },
  { id: 'clap', label: 'Clap', file: 'clap.wav' },
  { id: 'ride', label: 'Ride', file: 'ride.wav' },
  { id: 'ohh', label: 'Open Hi Hat', file: 'openhh.wav' },
  { id: 'vox', label: 'Vox', file: 'vox.wav' },
]

export type PresetDef = {
  id: string
  name: string
}

export const PRESETS: PresetDef[] = [
  { id: 'trap', name: 'Trap' },
  { id: 'house', name: 'House' },
]
