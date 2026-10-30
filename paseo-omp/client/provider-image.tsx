import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { type OmpImageTimelineData, visibleOmpImageText } from "../shared/provider-image";

export function OmpImageTimeline({ item, theme }: PluginTimelineItemProps<OmpImageTimelineData>) {
  const styles = useMemo(
    () => ({
      root: { gap: 8 },
      label: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      text: { color: theme.colors.foreground, fontSize: 13 },
      image: {
        width: "100%" as const,
        minHeight: 220,
        aspectRatio: 16 / 9,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
      },
      imageFallback: {
        alignItems: "center" as const,
        justifyContent: "center" as const,
        padding: 16,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      imageFallbackText: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        textAlign: "center" as const,
      },
    }),
    [theme],
  );
  const [enlargedIndex, setEnlargedIndex] = useState<number | null>(null);
  const enlarged = enlargedIndex === null ? undefined : item.data.images[enlargedIndex];
  const [failedImageIds, setFailedImageIds] = useState<ReadonlySet<string>>(() => new Set());
  const visibleText = useMemo(() => visibleOmpImageText(item.data.text), [item.data.text]);
  return (
    <View style={styles.root}>
      <Text style={styles.label}>{item.data.label}</Text>
      {visibleText ? <Text style={styles.text}>{visibleText}</Text> : null}
      {item.data.images.map((image, index) =>
        failedImageIds.has(image.id) ? (
          <View key={image.id} style={[styles.image, styles.imageFallback]}>
            <Text style={styles.imageFallbackText}>
              {image.mimeType.replace("image/", "").toUpperCase()} image could not be rendered on
              this Paseo client.
            </Text>
          </View>
        ) : (
          <Pressable
            key={image.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Enlarge ${item.data.label} image ${index + 1}`}
            onPress={() => setEnlargedIndex(index)}
          >
            <Image
              source={{ uri: `data:${image.mimeType};base64,${image.data}` }}
              resizeMode="contain"
              accessibilityLabel={`${item.data.label} image ${index + 1}`}
              onError={() =>
                setFailedImageIds((current) => {
                  if (current.has(image.id)) return current;
                  return new Set([...current, image.id]);
                })
              }
              style={styles.image}
            />
          </Pressable>
        ),
      )}
      <Modal
        title={item.data.label}
        open={enlarged !== undefined}
        onOpenChange={(open) => {
          if (!open) setEnlargedIndex(null);
        }}
      >
        <Modal.Content scrollable={false}>
          {enlarged ? (
            <EnlargedImage
              uri={`data:${enlarged.mimeType};base64,${enlarged.data}`}
              label={item.data.label}
              theme={theme}
            />
          ) : null}
        </Modal.Content>
      </Modal>
    </View>
  );
}

/** Fits the image to the dialog; a tap shows it at its real pixel size, panned by scrolling. */
function EnlargedImage({
  uri,
  label,
  theme,
}: {
  uri: string;
  label: string;
  theme: PluginTimelineItemProps<OmpImageTimelineData>["theme"];
}) {
  const screen = useWindowDimensions();
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [actualSize, setActualSize] = useState(false);
  useEffect(() => {
    let current = true;
    Image.getSize(
      uri,
      (width, height) => current && setNatural({ width, height }),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [uri]);
  const height = Math.round(screen.height * 0.7);
  const canZoom = natural !== null;
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          actualSize ? `Fit ${label} image to window` : `Show ${label} image at actual size`
        }
        disabled={!canZoom}
        onPress={() => setActualSize((value) => !value)}
      >
        {actualSize && natural ? (
          <ScrollView style={{ height }} nestedScrollEnabled>
            <ScrollView horizontal nestedScrollEnabled>
              <Image
                source={{ uri }}
                accessibilityLabel={`${label} enlarged image`}
                style={{ width: natural.width, height: natural.height }}
              />
            </ScrollView>
          </ScrollView>
        ) : (
          <Image
            source={{ uri }}
            resizeMode="contain"
            accessibilityLabel={`${label} enlarged image`}
            style={{ width: "100%", height }}
          />
        )}
      </Pressable>
      {canZoom ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, textAlign: "center" }}>
          {actualSize
            ? `${natural.width} × ${natural.height}px · tap to fit`
            : `Tap the image to see it at ${natural.width} × ${natural.height}px`}
        </Text>
      ) : null}
    </View>
  );
}
