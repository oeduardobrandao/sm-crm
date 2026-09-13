-- CTA por página (adendo da spec 2026-09-04): until_cta vale com CTA global OU com
-- CTA completo (label e url) em alguma página. jsonb_path_exists é IMMUTABLE, então
-- serve em CHECK.
alter table global_popups
  drop constraint global_popups_until_cta_needs_cta_check;

alter table global_popups
  add constraint global_popups_until_cta_needs_cta_check
  check (
    frequency <> 'until_cta'
    or cta_url is not null
    or jsonb_path_exists(pages, '$[*] ? (@.cta_url != null && @.cta_label != null)')
  );
