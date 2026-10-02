import { app } from 'electron'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A one-page PDF with a single line of text, written by hand so tests need no PDF library. */
export function tinyPdf(text: string): string {
  const body = `BT /F1 18 Tf 50 700 Td (${text}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return pdf
}

export interface Sandbox {
  home: string
  path(...parts: string[]): string
  cleanup(): void
}

/**
 * A fake home directory with a few realistic files, wired into the Electron mock's paths.
 * Nothing in these tests ever touches the real home directory.
 */
export function makeSandbox(): Sandbox {
  const home = mkdtempSync(join(tmpdir(), 'miaozhu-test-'))
  const path = (...parts: string[]) => join(home, ...parts)
  for (const d of ['Documents', 'Desktop', 'Downloads', 'Other', '.ssh']) mkdirSync(path(d))
  writeFileSync(path('Documents', 'notes.txt'), '會議記錄：週五交報告')
  writeFileSync(path('Documents', 'todo.md'), '- buy milk')
  writeFileSync(path('Documents', 'report.pdf'), tinyPdf('Quarterly revenue grew 12 percent'))
  writeFileSync(path('Documents', 'photo.png'), 'not really a png')
  writeFileSync(path('Other', 'a.txt'), 'outside A')
  writeFileSync(path('Other', 'b.txt'), 'outside B')
  writeFileSync(path('Desktop', 'trash-me.txt'), 'x')
  writeFileSync(path('.ssh', 'id_rsa'), 'SECRET-KEY')

  app.setPath('home', home)
  app.setPath('userData', path('.app-data'))
  app.setPath('temp', path('tmp'))
  app.setPath('desktop', path('Desktop'))
  app.setPath('documents', path('Documents'))
  app.setPath('downloads', path('Downloads'))
  mkdirSync(path('.app-data'))

  return { home, path, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}
