import { describe, expect, it } from 'vitest'
import type {
  BrandGuidelineSection,
  BrandId,
  BrandWithSections,
  SectionId,
  WorkspaceId,
} from '@brandfactory/shared'
import { buildSystemPrompt } from './system-prompt'

const ts = '2026-04-19T00:00:00.000Z'

const pmParagraph = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

function makeSection(
  overrides: Partial<BrandGuidelineSection> & Pick<BrandGuidelineSection, 'label' | 'priority'>,
): BrandGuidelineSection {
  return {
    id: `sec_${overrides.label}` as SectionId,
    brandId: 'b1' as BrandId,
    label: overrides.label,
    body: overrides.body ?? pmParagraph(`${overrides.label} body`),
    priority: overrides.priority,
    createdBy: 'user',
    createdAt: ts,
    updatedAt: ts,
  }
}

function makeBrand(sections: BrandGuidelineSection[]): BrandWithSections {
  return {
    id: 'b1' as BrandId,
    workspaceId: 'w1' as WorkspaceId,
    name: 'Northstar Coffee',
    description: 'Specialty roaster with a minimalist aesthetic.',
    createdAt: ts,
    updatedAt: ts,
    sections,
  }
}

describe('buildSystemPrompt', () => {
  it('includes brand name, description, section labels in priority order, and plain-text bodies', () => {
    const sections = [
      makeSection({ label: 'Voice', priority: 20, body: pmParagraph('Warm and direct.') }),
      makeSection({
        label: 'Audience',
        priority: 10,
        body: pmParagraph('Urban millennials.'),
      }),
    ]
    const prompt = buildSystemPrompt(makeBrand(sections))

    expect(prompt).toContain('Northstar Coffee')
    expect(prompt).toContain('Specialty roaster with a minimalist aesthetic.')
    expect(prompt).toContain('Audience')
    expect(prompt).toContain('Urban millennials.')
    expect(prompt).toContain('Voice')
    expect(prompt).toContain('Warm and direct.')
    expect(prompt).not.toContain('"type":"paragraph"')

    const audienceIdx = prompt.indexOf('Audience')
    const voiceIdx = prompt.indexOf('Voice\n')
    expect(audienceIdx).toBeGreaterThan(-1)
    expect(voiceIdx).toBeGreaterThan(audienceIdx)
  })

  it('still renders the canvas-awareness contract when the brand has zero sections', () => {
    const brand = makeBrand([])
    const prompt = buildSystemPrompt(brand)
    expect(prompt).toContain('Northstar Coffee')
    expect(prompt).toContain('CANVAS STATE')
    expect(prompt).not.toContain('## Brand guidelines')
  })
})
