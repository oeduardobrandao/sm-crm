// T3.1/T3.6 — the editor's brand-kit data source. Resolves the open post to its client
// (workflow_posts → workflows.cliente_id), then loads hub_brand through the SAME store fn and
// query key HubTab uses (['hub-brand-crm', clienteId]) so the two screens share one cache entry
// and one invalidation. On top of the raw row it derives the editor-ready shapes:
//  - brandColors: primary/secondary normalized to schema hex (legacy free-text values that
//    aren't hex are silently dropped — a swatch must always be a paintable color);
//  - brandFonts: font_primary/secondary resolved through the SHARED matcher
//    (@mesaas/fonts/match — the exact implementation MCP's get_design_capabilities uses), key
//    null when unmatched/ambiguous so the UI can show "não incluída no Estúdio" instead of
//    guessing.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import rawManifest from '@mesaas/fonts/manifest.json';
import { matchBrandFont } from '@mesaas/fonts/match';
import type { FontManifest } from '@mesaas/fonts/types';
import { getHubBrand, type HubBrandRow } from '@/store';
import { normalizeHexInput } from '../components/shared/ColorPicker';
import type { BrandFontEntry } from '../components/shared/FontPicker';

const FONT_MANIFEST = rawManifest as unknown as FontManifest;

export interface PostBrand {
  clienteId: number | null;
  brand: HubBrandRow | null;
  brandColors: string[];
  brandFonts: BrandFontEntry[];
  logoFileId: number | null;
  logoUrl: string | null;
}

export function deriveBrandColors(brand: HubBrandRow | null): string[] {
  return [brand?.primary_color, brand?.secondary_color]
    .map((raw) => (raw ? normalizeHexInput(raw) : null))
    .filter((hex): hex is string => hex !== null);
}

export function deriveBrandFonts(brand: HubBrandRow | null): BrandFontEntry[] {
  return [brand?.font_primary, brand?.font_secondary]
    .map((raw) => raw?.trim())
    .filter((raw): raw is string => !!raw)
    .map((raw) => ({ raw, key: matchBrandFont(raw, FONT_MANIFEST.families) }));
}

export function postClienteQueryKey(postId: number | undefined) {
  return ['estudio-post-cliente', postId] as const;
}

/** postId → cliente_id via the workflow join (workflow_posts has no cliente column). */
export function usePostCliente(postId: number | undefined) {
  return useQuery({
    queryKey: postClienteQueryKey(postId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_posts')
        .select('workflow_id, workflows!inner(cliente_id)')
        .eq('id', postId!)
        .maybeSingle();
      if (error) throw error;
      const cliente = (data as { workflows: { cliente_id: number } } | null)?.workflows?.cliente_id;
      return typeof cliente === 'number' ? cliente : null;
    },
    enabled: postId !== undefined && !Number.isNaN(postId),
    staleTime: Infinity, // a post never changes client
    retry: false,
  });
}

export function usePostBrand(postId: number | undefined): PostBrand {
  const clienteQuery = usePostCliente(postId);
  const clienteId = clienteQuery.data ?? null;

  const brandQuery = useQuery({
    // Key parity with HubTab (T3.6): edits saved there invalidate here and vice versa.
    queryKey: ['hub-brand-crm', clienteId],
    queryFn: () => getHubBrand(clienteId!),
    enabled: clienteId !== null,
  });

  const brand = brandQuery.data?.brand ?? null;
  return {
    clienteId,
    brand,
    brandColors: deriveBrandColors(brand),
    brandFonts: deriveBrandFonts(brand),
    logoFileId: brand?.logo_file_id ?? null,
    logoUrl: brand?.logo_url?.trim() ? brand.logo_url.trim() : null,
  };
}
