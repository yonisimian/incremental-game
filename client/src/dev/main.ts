import 'uplot/dist/uPlot.min.css'
import './dev.css'
// Register the bundled tree BEFORE importing ui.js — `strategies.ts` (pulled in
// transitively) calls `getModeDefinition` at module-evaluation time, which
// throws unless a tree is already loaded. Side-effect import order matters here.
import './bootstrap.js'
import { initDevPanel } from './ui.js'

initDevPanel(document.getElementById('dev-app')!)
