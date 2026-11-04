/**
 * The six milestones of the experience. Each chapter owns a "pose": where the
 * camera is, what it looks at, and how the placeholder object and lighting
 * look when that chapter is reached. Poses are flat numbers so GSAP can tween
 * them directly.
 *
 * Chapter i is fully reached when scroll progress = i / (chapters.length - 1),
 * which lines up with the top of the i-th HTML section.
 */

export interface Pose {
  camX: number
  camY: number
  camZ: number
  lookX: number
  lookY: number
  lookZ: number
  objX: number
  objY: number
  objZ: number
  rotX: number
  rotY: number
  rotZ: number
  scale: number
  /** Environment (reflection) light strength. */
  env: number
  /** Key directional light strength. */
  key: number
}

type Vec3 = readonly [number, number, number]

function pose(
  cam: Vec3,
  look: Vec3,
  pos: Vec3,
  rot: Vec3,
  scale: number,
  env: number,
  key: number,
): Pose {
  return {
    camX: cam[0],
    camY: cam[1],
    camZ: cam[2],
    lookX: look[0],
    lookY: look[1],
    lookZ: look[2],
    objX: pos[0],
    objY: pos[1],
    objZ: pos[2],
    rotX: rot[0],
    rotY: rot[1],
    rotZ: rot[2],
    scale,
    env,
    key,
  }
}

export interface Chapter {
  id: string
  label: string
  summary: string
  pose: Pose
}

export const chapters: readonly Chapter[] = [
  {
    id: 'opening',
    label: 'Opening / Awakening',
    summary: 'Darkness, then the first light.',
    pose: pose([0, 0.2, 7.5], [0, 0, 0], [0, -0.3, 0], [0.2, 0, 0], 0.8, 0.12, 0.2),
  },
  {
    id: 'acceleration',
    label: 'Acceleration',
    summary: 'The camera and subject gain speed.',
    pose: pose([3, 0.6, 5], [0, 0, 0], [0.5, 0, 0], [0.4, 1.6, 0.1], 1, 0.5, 0.6),
  },
  {
    id: 'transformation',
    label: 'Environmental Transformation',
    summary: 'The space around the subject changes.',
    pose: pose([-4, 1.5, 3.5], [0, 0, 0], [0, 0.2, 0], [0.7, 3.2, 0.3], 1.3, 1.2, 1.4),
  },
  {
    id: 'capabilities',
    label: 'Digital Capabilities',
    summary: 'Services are demonstrated in context.',
    pose: pose([0, 3.5, 5], [0, 0, 0], [-1.2, 0, 0], [0.2, 4.5, 0], 0.9, 0.8, 0.9),
  },
  {
    id: 'portfolio',
    label: 'Portfolio Gallery',
    summary: 'Selected work, framed one piece at a time.',
    pose: pose([2.5, -0.5, 7], [0.5, 0, 0], [1.2, 0, -1], [0, 5.5, 0.2], 0.7, 0.9, 0.8),
  },
  {
    id: 'invitation',
    label: 'Final Project Invitation',
    summary: 'The camera settles. Start a project.',
    pose: pose([0, 0, 4.2], [0, 0, 0], [0, 0, 0], [0.3, Math.PI * 2, 0], 1.1, 1, 1),
  },
]

/** Which chapter is "current" for a given scroll progress (0..1). */
export function chapterIndexForProgress(progress: number): number {
  const last = chapters.length - 1
  return Math.min(last, Math.max(0, Math.round(progress * last)))
}
