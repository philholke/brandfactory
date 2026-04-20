import { Link } from '@tanstack/react-router'
import type { BrandWithSections, Project } from '@brandfactory/shared'

export function TopBar({ project, brand }: { project: Project; brand: BrandWithSections }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4 text-sm">
      <Link
        to="/brands/$brandId"
        params={{ brandId: brand.id }}
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        {brand.name}
      </Link>
      <span className="text-muted-foreground">/</span>
      <span className="font-medium">{project.name}</span>
    </div>
  )
}
