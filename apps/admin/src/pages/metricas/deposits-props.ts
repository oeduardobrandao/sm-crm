import type { DepositsResponse } from '../../lib/api';

/** What DepositsSection hands to the desktop and phone views. */
export interface DepositsViewProps {
  data: DepositsResponse | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
}
