// packages/ui/index.ts
//
// NOT importable from the Hub, despite the name. Every re-export below reaches
// into apps/crm, and those components import '@/lib/utils' — an alias each app
// points at its own src, so in the Hub it resolves to apps/hub/src/lib/utils and
// fails. Nothing imports this barrel today for that reason.
//
// Genuinely shared components live as standalone files in this package instead
// (see FlagIcon.tsx) and are imported by path — '@mesaas/ui/FlagIcon' — which
// both apps alias. Add to that pattern rather than to this list, unless you are
// also fixing the '@/' leak.
export { Button } from '../../apps/crm/src/components/ui/button';
export { Badge } from '../../apps/crm/src/components/ui/badge';
export { Spinner } from '../../apps/crm/src/components/ui/spinner';
export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../apps/crm/src/components/ui/dialog';
export { Input } from '../../apps/crm/src/components/ui/input';
export { Label } from '../../apps/crm/src/components/ui/label';
