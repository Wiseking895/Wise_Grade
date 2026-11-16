import { Link } from 'react-router-dom'
import logo from '../images/wiseGrade.jpeg'

/**
 * Wise Grade brand mark.
 *
 * The supplied artwork `src/images/wiseGrade.jpeg` is displayed unmodified with
 * its aspect ratio preserved. The navigation brand area intentionally contains
 * only the logo; the product name is provided to assistive technology through
 * the link's accessible label.
 */
export default function BrandMark() {
  return (
    <Link
      to="/"
      aria-label="Wise Grade home"
      className="inline-flex shrink-0 items-center rounded-xl"
    >
      <img
        src={logo}
        alt=""
        width={1254}
        height={1254}
        className="h-14 w-auto sm:h-16"
      />
    </Link>
  )
}
