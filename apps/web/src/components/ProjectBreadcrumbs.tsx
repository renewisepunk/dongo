import { A } from "@solidjs/router";

import "./project-breadcrumbs.css";

export type ProjectBreadcrumbsProps = {
  orgSlug: string;
  projectSlug: string;
  projectName: string;
  current: string;
  projectHref?: string;
};

export function ProjectBreadcrumbs(props: ProjectBreadcrumbsProps) {
  const overviewHref = () => props.projectHref ??
    `/app/${encodeURIComponent(props.orgSlug)}/${encodeURIComponent(props.projectSlug)}`;

  return (
    <nav class="project-breadcrumbs" aria-label="Breadcrumb">
      <ol class="project-breadcrumbs__list">
        <li class="project-breadcrumbs__separator" aria-hidden="true">/</li>
        <li class="project-breadcrumbs__project">
          <A class="project-breadcrumbs__link" href={overviewHref()}>
            {props.projectName}
          </A>
        </li>
        <li class="project-breadcrumbs__separator" aria-hidden="true">/</li>
        <li class="project-breadcrumbs__current" aria-current="page">
          {props.current}
        </li>
      </ol>
    </nav>
  );
}
