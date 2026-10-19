// Contest-scoped results: shared list prefilled with contest, side nav stays visible.
import ResultsPage from '../../../results/page';

export default function ContestResultsPage({ params }) {
  return <ResultsPage searchParams={{ contest: params.id }} />;
}
