import SiteFooter from "@/components/home/site-footer";
import SiteHeader from "@/components/home/site-header";

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[760px] px-6 py-12 max-[560px]:px-5 max-[560px]:py-8">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
