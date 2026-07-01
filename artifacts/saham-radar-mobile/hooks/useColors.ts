import colors from '@/constants/colors';

/**
 * Returns the design tokens for the current color scheme.
 * SahamRadar uses a dark-only theme matching the web app.
 */
export function useColors() {
  return { ...colors.dark, radius: colors.radius };
}
