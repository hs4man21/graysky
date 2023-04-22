import { useMemo, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { AppBskyFeedDefs } from "@atproto/api";
import { FlashList } from "@shopify/flash-list";
import { useInfiniteQuery } from "@tanstack/react-query";

import { Button } from "../../components/button";
import { FeedPost } from "../../components/feed-post";
import { useAuthedAgent } from "../../lib/agent";
import { assert } from "../../lib/utils/assert";
import { cx } from "../../lib/utils/cx";

const actorFromPost = (item: AppBskyFeedDefs.FeedViewPost) => {
  if (AppBskyFeedDefs.isReasonRepost(item.reason)) {
    assert(AppBskyFeedDefs.validateReasonRepost(item.reason));
    return item.reason.by.did;
  } else {
    return item.post.author.did;
  }
};

export default function Timeline() {
  const [mode, setMode] = useState<"popular" | "following" | "mutuals">(
    "following",
  );
  const agent = useAuthedAgent();

  const timeline = useInfiniteQuery({
    queryKey: ["timeline", mode],
    queryFn: async ({ pageParam }) => {
      switch (mode) {
        case "popular":
          const popular = await agent.app.bsky.unspecced.getPopular({
            cursor: pageParam as string | undefined,
          });
          return popular.data;
        case "following":
          const following = await agent.getTimeline({
            cursor: pageParam as string | undefined,
          });
          return following.data;
        case "mutuals":
          const all = await agent.getTimeline({
            cursor: pageParam as string | undefined,
          });
          const actors = new Set<string>();
          for (const item of all.data.feed) {
            const actor = actorFromPost(item);
            actors.add(actor);
          }
          const profiles = await agent.getProfiles({ actors: [...actors] });
          return {
            feed: all.data.feed.filter((item) => {
              const actor = actorFromPost(item);
              const profile = profiles.data.profiles.find(
                (profile) => profile.did === actor,
              );
              if (!profile) return false;
              return profile.viewer?.following && profile.viewer?.followedBy;
            }),
            cursor: all.data.cursor,
          };
      }
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
  });

  const data = useMemo(() => {
    if (timeline.status !== "success") return [];
    const flattened = timeline.data.pages.flatMap((page) => page.feed);
    return flattened
      .map((item) =>
        item.reply
          ? [
              { item: { post: item.reply.parent }, hasReply: true },
              { item, hasReply: false },
            ]
          : [{ item, hasReply: false }],
      )
      .flat();
  }, [timeline]);

  const header = (
    <>
      <Stack.Screen options={{ headerShown: true }} />
      <View className="w-full flex-row border-b border-neutral-200 bg-white">
        <TouchableOpacity
          onPress={() => setMode("following")}
          className={cx(
            "ml-4 border-y-2 border-transparent py-3 text-xl",
            mode === "following" && "border-b-black",
          )}
        >
          <Text className="font-medium">Following</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setMode("popular")}
          className={cx(
            "ml-4 border-y-2 border-transparent py-3 text-xl",
            mode === "popular" && "border-b-black",
          )}
        >
          <Text>What&apos;s Hot</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setMode("mutuals")}
          className={cx(
            "ml-4 border-y-2 border-transparent py-3 text-xl",
            mode === "mutuals" && "border-b-black",
          )}
        >
          <Text>Mutuals</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  switch (timeline.status) {
    case "loading":
      return (
        <>
          {header}
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        </>
      );

    case "error":
      return (
        <>
          {header}
          <View className="flex-1 items-center justify-center p-4">
            <Text className="text-center text-xl">
              {(timeline.error as Error).message || "An error occurred"}
            </Text>
            <Button variant="outline" onPress={() => void timeline.refetch()}>
              Retry
            </Button>
          </View>
        </>
      );

    case "success":
      return (
        <>
          {header}
          <FlashList
            data={data}
            renderItem={({ item: { hasReply, item } }) => (
              <FeedPost item={item} hasReply={hasReply} />
            )}
            onEndReachedThreshold={0.5}
            onEndReached={() => void timeline.fetchNextPage()}
            onRefresh={() => {
              if (!timeline.isRefetching) void timeline.refetch();
            }}
            refreshing={timeline.isRefetching}
            estimatedItemSize={91}
            ListFooterComponent={
              timeline.isFetching ? (
                <View className="w-full items-center py-4">
                  <ActivityIndicator />
                </View>
              ) : null
            }
          />
        </>
      );
  }
}