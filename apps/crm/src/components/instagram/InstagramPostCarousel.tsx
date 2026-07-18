import type { Key, ReactElement, ReactNode } from 'react';

export interface InstagramPostCarouselProps<T> {
  title: string;
  description?: string;
  ariaLabel: string;
  icon?: ReactNode;
  posts: readonly T[];
  getKey: (post: T) => Key;
  renderPost: (post: T) => ReactNode;
  action?: ReactNode;
}

export function InstagramPostCarousel<T>({
  title,
  description,
  ariaLabel,
  icon,
  posts,
  getKey,
  renderPost,
  action,
}: InstagramPostCarouselProps<T>): ReactElement | null {
  if (posts.length === 0) return null;

  return (
    <section className="card animate-up instagram-post-carousel" aria-label={ariaLabel}>
      <div className="dashboard-hub-card-header instagram-post-carousel__header">
        <div>
          <h3>
            {icon}
            {title}
          </h3>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      <div className="instagram-post-carousel__track" role="list">
        {posts.map((post) => (
          <div key={getKey(post)} className="instagram-post-carousel__item" role="listitem">
            {renderPost(post)}
          </div>
        ))}
      </div>
    </section>
  );
}
