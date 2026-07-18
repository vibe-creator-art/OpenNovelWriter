import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { formatPromptTemplate, getPromptTemplateSyntaxError } from './prompt-template-format'

describe('formatPromptTemplate', () => {
    test('aligns Nunjucks and standalone XML-like blocks while collapsing blank lines', () => {
        const source = [
            '<ResponseGuidance>',
            '',
            '',
            '{% if enabled %}',
            '<Planning>',
            '',
            '',
            'plan text',
            '</Planning>',
            '{% else %}',
            '<Content>',
            'content text',
            '</Content>',
            '{% endif %}',
            '',
            '',
            '</ResponseGuidance>',
            '',
        ].join('\n')

        assert.equal(formatPromptTemplate(source), [
            '<ResponseGuidance>',
            '',
            '\t{% if enabled %}',
            '\t\t<Planning>',
            '',
            '\t\t\tplan text',
            '\t\t</Planning>',
            '\t{% else %}',
            '\t\t<Content>',
            '\t\t\tcontent text',
            '\t\t</Content>',
            '\t{% endif %}',
            '',
            '</ResponseGuidance>',
        ].join('\n'))
    })

    test('preserves explicit whitespace control and is idempotent', () => {
        const source = '<Root>\n\n  {%- if enabled -%}  \nvalue\n  {%- endif -%}\n\n</Root>'
        const formatted = formatPromptTemplate(source)

        assert.equal(formatted, '<Root>\n\n\t{%- if enabled -%}\n\t\tvalue\n\t{%- endif -%}\n\n</Root>')
        assert.equal(formatPromptTemplate(formatted), formatted)
    })

    test('does not rewrite raw block or fenced code contents', () => {
        const source = '{% raw %}\n  {% if untouched %}\n\n\n    raw text  \n{% endraw %}\n```txt\n  code\n\n\n```'

        assert.equal(formatPromptTemplate(source), source)
    })
})

describe('getPromptTemplateSyntaxError', () => {
    test('accepts valid templates', () => {
        assert.equal(getPromptTemplateSyntaxError('{% if enabled %}ok{% endif %}'), null)
    })

    test('returns the runtime syntax warning for invalid templates', () => {
        const warning = getPromptTemplateSyntaxError('{% if enabled %}missing endif')

        assert.equal(warning?.type, 'unsupported_template_syntax')
        assert.match(warning?.name ?? '', /endif/)
    })
})
