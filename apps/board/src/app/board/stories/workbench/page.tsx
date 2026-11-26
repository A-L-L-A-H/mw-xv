import { StoryWorkbenchPage } from '../../../../board-pages/story-workbench-page';
import { ComicTheaterSection } from '@/components/creative/comic-theater-section';

export default function StoryWorkbenchRoute() {
  return (
    <div className="space-y-6">
      <StoryWorkbenchPage />
      <ComicTheaterSection />
    </div>
  );
}
