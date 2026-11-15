import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import { usePathname } from "fumadocs-core/framework";
import { useStaticSearch } from "fumadocs-core/search/client";
import { base } from "@/lib/shared";

export default function DefaultSearchDialog(props: SharedProps) {
  // The version being read is the first part of the path after the base,
  // `next` or `v6`. Results come from that version only.
  const version = usePathname().slice(base.length).split("/")[1];
  const search = useStaticSearch({ from: `${base}/api/search`, tag: version });

  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList />
      </SearchDialogContent>
    </SearchDialog>
  );
}
