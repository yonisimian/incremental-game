// @vitest-environment happy-dom
//
// Volumes persist across reloads and survive whatever is in storage. DOM tier
// for a real localStorage; each test re-imports the module to replay its load.

import { afterEach, describe, expect, it, vi } from 'vitest'

async function load(stored?: string) {
  if (stored !== undefined) localStorage.setItem('audio-settings', stored)
  vi.resetModules()
  return import('../src/ui/audio-settings.js')
}

afterEach(() => {
  localStorage.clear()
})

describe('audio settings', () => {
  it('defaults when nothing is stored', async () => {
    const { getAudioSettings } = await load()
    expect(getAudioSettings()).toEqual({ music: 70, sfx: 80 })
  })

  it('persists each volume and reads it back on the next load', async () => {
    const first = await load()
    first.setMusicVolume(10)
    first.setSfxVolume(55)

    const second = await load()
    expect(second.getAudioSettings()).toEqual({ music: 10, sfx: 55 })
  })

  it('clamps to 0–100 and rounds to whole percents', async () => {
    const { getAudioSettings, setMusicVolume, setSfxVolume } = await load()
    setMusicVolume(140)
    setSfxVolume(-3.6)
    expect(getAudioSettings()).toEqual({ music: 100, sfx: 0 })
    setMusicVolume(33.4)
    expect(getAudioSettings().music).toBe(33)
  })

  it('falls back per field on garbage in storage', async () => {
    expect((await load('not json')).getAudioSettings()).toEqual({ music: 70, sfx: 80 })
    expect((await load('{"music":"loud","sfx":40}')).getAudioSettings()).toEqual({
      music: 70,
      sfx: 40,
    })
  })
})
