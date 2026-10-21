import type { DashboardFollowerEntry, DashboardReachEntry } from '../../types';
import { FollowerChart } from './FollowerChart';
import { ReachChart } from './ReachChart';

// Its own chunk: chart.js is most of the Home page's JavaScript and sits below
// the fold, so DashboardSection loads it lazily instead of HomePage carrying it.
export default function DashboardCharts({
  followerHistory,
  reachHistory,
}: {
  followerHistory: DashboardFollowerEntry[];
  reachHistory: DashboardReachEntry[];
}) {
  return (
    <>
      <FollowerChart followerHistory={followerHistory} />
      <ReachChart reachHistory={reachHistory} />
    </>
  );
}
