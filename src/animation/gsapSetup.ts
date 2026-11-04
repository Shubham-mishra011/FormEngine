import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// Register plugins once, here. Every other file imports gsap from this module
// so registration is guaranteed to have happened.
gsap.registerPlugin(ScrollTrigger)

export { gsap, ScrollTrigger }
