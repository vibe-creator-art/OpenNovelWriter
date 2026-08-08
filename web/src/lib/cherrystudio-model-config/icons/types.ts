import type { SVGProps } from 'react'

export type IconComponent = (props: SVGProps<SVGSVGElement>) => React.JSX.Element
export type ThemedIcon = { light: IconComponent; dark?: IconComponent }
