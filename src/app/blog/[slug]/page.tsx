import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { POSTS, post as find } from "@/components/site/blog-data";
import { Article, BlogShell, SITE } from "@/components/site/blog";

export const dynamicParams = false;
export const generateStaticParams = () => POSTS.map((p) => ({ slug: p.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = find((await params).slug);
  if (!p) return {};
  const url = `/blog/${p.slug}`;
  return {
    title: { absolute: `${p.title} | Medoro` },
    description: p.description,
    alternates: { canonical: url },
    openGraph: { type: "article", url, siteName: "Medoro", title: p.title, description: p.description, locale: "en_IN", publishedTime: p.published, modifiedTime: p.updated },
    twitter: { card: "summary_large_image", title: p.title, description: p.description },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const p = find((await params).slug);
  if (!p) notFound();
  const url = `${SITE}/blog/${p.slug}`;
  const jsonLd = [
    {
      "@context": "https://schema.org", "@type": "BlogPosting", headline: p.title, description: p.description, url,
      mainEntityOfPage: url, datePublished: p.published, dateModified: p.updated, inLanguage: "en-IN",
      author: { "@type": "Organization", name: "Medoro", url: SITE },
      publisher: { "@type": "Organization", name: "Medoro", url: SITE, logo: { "@type": "ImageObject", url: `${SITE}/medoro-logo.png` } },
    },
    {
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Medoro", item: SITE },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE}/blog` },
        { "@type": "ListItem", position: 3, name: p.title, item: url },
      ],
    },
  ];
  return (
    <BlogShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Article post={p} />
    </BlogShell>
  );
}
