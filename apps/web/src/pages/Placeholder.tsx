import { PageHeader, Card, EmptyState } from '../ui'

export default function Placeholder({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState title="Em construção" description="Esta tela ainda vai ser desenhada." />
      </Card>
    </>
  )
}
