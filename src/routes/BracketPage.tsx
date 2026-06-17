import { getBracket, useData } from '../lib/data';
import BracketView from '../components/BracketView';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui';

export default function BracketPage() {
  const { data: bracket, loading, error } = useData(getBracket);

  if (loading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!bracket || Object.keys(bracket).length === 0)
    return (
      <div>
        <PageHeader title="Knockout Bracket" />
        <EmptyState message="The knockout bracket appears once the group stage concludes." />
      </div>
    );

  return (
    <div>
      <PageHeader
        title="Knockout Bracket"
        subtitle="Round of 32 → Final · scroll horizontally to follow the path"
      />
      <BracketView bracket={bracket} />
    </div>
  );
}
