import 'uplot/dist/uPlot.min.css'
import './dev.css'
import { buildIdlerTreeFile, loadTree } from '@game/shared'
import { initDevPanel } from './ui.js'

// The dev panel runs fully offline (no server), so it registers the bundled
// tree directly instead of fetching it like the live client does.
loadTree(buildIdlerTreeFile())

initDevPanel(document.getElementById('dev-app')!)
