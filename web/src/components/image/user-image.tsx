import type { ImgHTMLAttributes } from 'react'

/**
 * Native `img` for user-generated, blob, and arbitrary remote URLs.
 *
 * `next/image` is the wrong tool here: hosts are unknown, crop math needs a
 * real image element, and blob / data previews cannot go through the optimizer.
 */
export function UserImage(props: ImgHTMLAttributes<HTMLImageElement>) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...props} />
}
