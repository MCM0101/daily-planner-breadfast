import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
type Task = {
  id: string;
  title: string;
  day: string;
  comment: string;
  done: number;
  time?: string;
};
export function createPlannerPdf(tasks: Task[], label: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  doc.setProperties({
    title: "Daybook - " + label,
    subject: "Tasks, completion status, and comments",
    creator: "Daybook",
  });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(23);
  doc.setTextColor(105, 48, 94);
  doc.text("daybook.", 16, 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(50, 43, 55);
  doc.text(label, 16, 31);
  doc.setFontSize(10);
  doc.setTextColor(90, 80, 98);
  doc.text(
    `${tasks.length} tasks | ${tasks.filter((t) => t.done).length} done | ${tasks.filter((t) => !t.done).length} open`,
    16,
    39,
  );
  const days = [...new Set(tasks.map((t) => t.day))].sort();
  let nextY = 46;
  for (const day of days) {
    const list = tasks
      .filter((t) => t.day === day)
      .sort((a, b) => {
        if (a.time && b.time) return a.time.localeCompare(b.time);
        if (a.time) return -1;
        if (b.time) return 1;
        return a.id.localeCompare(b.id);
      });
    const date = new Date(day + "T12:00:00").toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    autoTable(doc, {
      startY: nextY,
      head: [
        [
          {
            content:
              date +
              "  (" +
              list.filter((t) => t.done).length +
              "/" +
              list.length +
              " done)",
            colSpan: 3,
            styles: {
              fillColor: [236, 228, 237],
              textColor: [80, 43, 75],
              fontStyle: "bold",
              minCellHeight: 11,
            },
          },
        ],
        ["Status", "Task", "Comment / update"],
      ],
      body: list.map((t) => [
        t.done ? "Done" : "Open",
        t.time ? `${t.time} - ${t.title}` : t.title,
        t.comment || "-",
      ]),
      margin: { top: 20, right: 16, bottom: 18, left: 16 },
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 10,
        cellPadding: 3,
        lineColor: [225, 220, 229],
        lineWidth: 0.15,
        overflow: "linebreak",
        valign: "top",
      },
      headStyles: {
        fillColor: [112, 54, 101],
        textColor: 255,
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 76 },
        2: { cellWidth: width - 32 - 94 },
      },
      pageBreak: "avoid",
      rowPageBreak: "avoid",
      showHead: "everyPage",
    });
    nextY = (doc as any).lastAutoTable.finalY + 6;
  }
  if (!tasks.length) {
    doc.setFontSize(12);
    doc.text("No tasks in this period.", 16, 52);
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.setTextColor(110, 101, 116);
    doc.text("Daybook | " + label, 16, doc.internal.pageSize.getHeight() - 9);
    doc.text(
      `${i} / ${pages}`,
      width - 16,
      doc.internal.pageSize.getHeight() - 9,
      { align: "right" },
    );
  }
  return doc;
}
export function downloadPlannerPdf(
  tasks: Task[],
  label: string,
  filename: string,
) {
  createPlannerPdf(tasks, label).save(filename);
}
