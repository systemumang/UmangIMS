import React, { useEffect, useState } from 'react';

type Props = {
  href?: string | null;
  label?: string;
  className?: string;
};

/** Shows a document link only when a locally stored upload still exists. */
export default function AvailableDocumentLink({ href, label = 'View', className = 'text-primary underline' }: Props) {
  const url = String(href ?? '').trim();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!url) {
      setAvailable(false);
      return;
    }
    // External links are owned by another provider; do not hide them on a CORS failure.
    if (!url.startsWith('/api/uploads/')) {
      setAvailable(true);
      return;
    }
    const controller = new AbortController();
    setAvailable(false);
    fetch(url, { method: 'HEAD', signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setAvailable(response.ok);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailable(false);
      });
    return () => controller.abort();
  }, [url]);

  if (!available) return null;
  return <a href={url} target="_blank" rel="noreferrer" className={className}>{label}</a>;
}
