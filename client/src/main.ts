import './style.css'
import { setMessageHandler, setConnectionStateHandler, connect } from './network.js'
import { handleServerMessage, setStateChangeHandler } from './game.js'
import { render, handleConnectionChange } from './ui/index.js'

// Wire modules together
setMessageHandler(handleServerMessage)
setStateChangeHandler(render)
setConnectionStateHandler(handleConnectionChange)

// Go!
void connect()
