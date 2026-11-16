import { getPrismaClient } from '../src/lib/prisma.js'

const prisma = getPrismaClient()
const migrations = await prisma.$queryRaw<
  { migration_name: string; finished_at: Date | null }[]
>`SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at`
console.log(migrations)
const columns = await prisma.$queryRaw<
  { column_name: string }[]
>`SELECT column_name FROM information_schema.columns WHERE table_name = 'AssessmentPolicy' ORDER BY column_name`
console.log(columns.map((column) => column.column_name))
await prisma.$disconnect()
