/** Feature pitches for the blog's "No Mesaas" block. The data lives in
 * packages/ui so the Admin shares it; this file only re-exports it, through a
 * relative path because the prerender import graph allows no aliases. */
export {
  BLOG_FEATURES,
  BLOG_FEATURE_SLUGS,
  type BlogFeature,
  type FeatureSlug,
} from '../../../../packages/ui/blog/features';
