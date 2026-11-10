import type { DashboardFollowerEntry, DashboardReachEntry, DashboardViewsEntry } from '../../types';
import { FollowerChart } from './FollowerChart';
import { ReachChart } from './ReachChart';
import { ViewsChart } from './ViewsChart';

type DashboardChartsProps =
  | {
      platform: 'instagram';
      followerHistory: DashboardFollowerEntry[];
      reachHistory: DashboardReachEntry[];
    }
  | {
      platform: 'tiktok';
      followerHistory: DashboardFollowerEntry[];
      viewsHistory: DashboardViewsEntry[];
      followerCaption?: string;
    };

// Its own chunk: chart.js is most of the Home page's JavaScript and sits below
// the fold, so DashboardSection loads it lazily instead of HomePage carrying it.
export default function DashboardCharts(props: DashboardChartsProps) {
  if (props.platform === 'tiktok') {
    return (
      <>
        <FollowerChart followerHistory={props.followerHistory} caption={props.followerCaption} />
        <ViewsChart viewsHistory={props.viewsHistory} />
      </>
    );
  }
  return (
    <>
      <FollowerChart followerHistory={props.followerHistory} />
      <ReachChart reachHistory={props.reachHistory} />
    </>
  );
}
