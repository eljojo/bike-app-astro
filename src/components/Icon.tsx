import { iconPaths } from './icon-paths';

interface Props {
  name: string;
  weight?: 'regular' | 'fill';
  size?: number;
  class?: string;
}

export default function Icon({ name, weight = 'regular', size = 24, class: className }: Props) {
  const key = `${name}/${weight}`;
  const pathData = iconPaths[key];

  if (!pathData) {
    return null;
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      class={className}
      dangerouslySetInnerHTML={{ __html: pathData }}
    />
  );
}
