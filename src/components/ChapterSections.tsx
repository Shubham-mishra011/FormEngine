import { chapters } from '../animation/chapters'

/**
 * One full-height HTML section per chapter. These give the page its scroll
 * length and keep the copy in real, accessible HTML. Text is temporary.
 */
export function ChapterSections() {
  return (
    <>
      {chapters.map((chapter, index) => (
        <section
          key={chapter.id}
          id={chapter.id}
          className="chapter"
          aria-labelledby={`${chapter.id}-title`}
        >
          <p className="chapter__index">{String(index + 1).padStart(2, '0')}</p>
          <h2 id={`${chapter.id}-title`} className="chapter__title">
            {chapter.label}
          </h2>
          <p className="chapter__summary">{chapter.summary}</p>
        </section>
      ))}
    </>
  )
}
